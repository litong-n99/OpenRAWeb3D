/**
 * DeliverUnit.ts — 运输机投放单位活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/DeliverUnit.cs
 *
 * 核心范式转换:
 * - C# Carryall trait → TypeScript 鸭子类型接口
 * - C# Land / Wait / TakeOff 子活动 → TypeScript 活动队列
 * - C# nested ReleaseUnit class → TypeScript nested private class
 * - C# self.World.AddFrameEndTask() → TypeScript world.queueFrameEndAction()
 * - C# w.Add(cargo) → TypeScript world.addActor(cargo)
 * - C# SubCell.FullCell → TypeScript SubCellLike.FullCell
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  CarryallLike,
  CarryableLike,
  BodyOrientationLike,
  IFacingLike,
  IPositionableLike,
} from './TransportActivityInterfaces.js'
import { CarryallState } from './TransportActivityInterfaces.js'

// ---------------------------------------------------------------------------
// DeliverUnit
// ---------------------------------------------------------------------------

/**
 * 运输机投放单位 — Carryall 将携带的 actor 投放到目标位置。
 *
 * OpenRA 对照: DeliverUnit activity
 *
 * 工作流程:
 * 1. onFirstRun: 着陆 → 等待 → 释放 → 起飞
 * 2. ReleaseUnit: 在帧末将 cargo 放回世界
 */
export class DeliverUnit extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  private readonly carryall: CarryallLike
  private readonly assignTargetOnFirstRun: boolean
  private readonly deliverRange: WDist
  private readonly targetLineColor: ColorStub | null

  private destination: Target

  // ---------------------------------------------------------------------------
  // Static factories for child activities (overridable for testing)
  // ---------------------------------------------------------------------------

  static _landFactory: ((self: GameActor, dest: Target, range: WDist) => Activity) | null = null
  static _waitFactory: ((delay: number) => Activity) | null = null
  static _takeOffFactory: ((self: GameActor) => Activity) | null = null

  // ---------------------------------------------------------------------------
  // Constructors
  // ---------------------------------------------------------------------------

  /**
   * 创建 DeliverUnit 活动 (自动分配目标)。
   *
   * OpenRA 对照: DeliverUnit(Actor self, WDist deliverRange, Color? targetLineColor)
   */
  static createAtCurrentLocation(
    self: GameActor,
    deliverRange: WDist,
    targetLineColor: ColorStub | null = null,
  ): DeliverUnit {
    return new DeliverUnit(self, Target.Invalid, deliverRange, targetLineColor, true)
  }

  /**
   * 创建 DeliverUnit 活动 (指定目标)。
   *
   * OpenRA 对照: DeliverUnit(Actor self, in Target destination, WDist deliverRange, Color? targetLineColor)
   */
  constructor(
    self: GameActor,
    destination: Target,
    deliverRange: WDist,
    targetLineColor: ColorStub | null = null,
    assignTargetOnFirstRun: boolean = false,
  ) {
    super()
    this.destination = destination
    this.deliverRange = deliverRange
    this.targetLineColor = targetLineColor
    this.assignTargetOnFirstRun = assignTargetOnFirstRun

    this.carryall = DeliverUnit._resolveCarryall(self)
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  protected override onFirstRun(self: GameActor): void {
    // In case this activity was queued, the cargo might have changed
    if (this.carryall.carryable === null ||
        this.carryall.state !== CarryallState.Carrying) {
      return
    }

    if (this.assignTargetOnFirstRun) {
      const location = (self as unknown as { location: CPos }).location
      this.destination = Target.fromCell(location)
    }

    // Queue the delivery sequence: Land → Wait → ReleaseUnit → TakeOff
    const landFactory = DeliverUnit._landFactory
    const waitFactory = DeliverUnit._waitFactory
    const takeOffFactory = DeliverUnit._takeOffFactory

    if (landFactory !== null) {
      this.queueChild(landFactory(self, this.destination, this.deliverRange))
    }

    const info = this.carryall.info
    if (info.beforeUnloadDelay > 0 && waitFactory !== null) {
      this.queueChild(waitFactory(info.beforeUnloadDelay))
    }

    this.queueChild(new ReleaseUnit(self, this.carryall))

    if (takeOffFactory !== null) {
      this.queueChild(takeOffFactory(self))
    }
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      return [new TargetLineNode(this.destination, this.targetLineColor)]
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution
  // ---------------------------------------------------------------------------

  private static _resolveCarryall(self: GameActor): CarryallLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<CarryallLike>
      if (typeof t.reserveCarryable === 'function' && typeof t.detachCarryable === 'function') {
        return t as CarryallLike
      }
    }
    throw new Error('DeliverUnit requires a Carryall trait on the actor')
  }
}

// ---------------------------------------------------------------------------
// ReleaseUnit (nested class)
// ---------------------------------------------------------------------------

/**
 * 释放单位 — 将 cargo 从 carryall 放回世界。
 *
 * OpenRA 对照: DeliverUnit.ReleaseUnit nested class
 */
class ReleaseUnit extends Activity {
  private readonly carryall: CarryallLike
  private readonly facing: IFacingLike | null
  private readonly body: BodyOrientationLike | null

  constructor(self: GameActor, carryall: CarryallLike) {
    super()
    this.carryall = carryall
    this.facing = ReleaseUnit._resolveFacing(self)
    this.body = ReleaseUnit._resolveBodyOrientation(self)
  }

  protected override onFirstRun(self: GameActor): void {
    // HACK: Activities still tick between the actor being killed and being disposed
    if (this.carryall.carryable === null) return

    const cargo = this.carryall.carryable
    const carryable = ReleaseUnit._resolveCarryable(cargo)
    if (carryable === null) return

    const selfOrientation = (self as unknown as { orientation?: WAngle }).orientation ?? new WAngle(0)
    const quantizedOrientation = this.body !== null
      ? this.body.quantizeOrientation(selfOrientation)
      : selfOrientation

    const localOffset = this.carryall.carryableOffset.rotate(WRot.fromYaw(quantizedOrientation))
    const targetPosition = (self as unknown as { centerPosition: { X: number; Y: number; Z: number } }).centerPosition
    const worldOffset = this.body !== null
      ? this.body.localToWorld(localOffset)
      : localOffset

    const targetPos = new WPos(
      targetPosition.X + worldOffset.X,
      targetPosition.Y + worldOffset.Y,
      targetPosition.Z + worldOffset.Z,
    )

    const world = (self as unknown as { world?: { map?: { cellContaining: (p: WPos) => CPos } } }).world
    const targetLocation = world?.map?.cellContaining(targetPos) ?? new CPos(0, 0)

    // Set cargo position
    const positionable = ReleaseUnit._resolvePositionable(cargo)
    if (positionable !== null) {
      positionable.setPosition(cargo, targetLocation) // uses default SubCell
    }

    const cargoFacing = ReleaseUnit._resolveFacing(cargo)
    if (cargoFacing !== null && this.facing !== null) {
      cargoFacing.facing = this.facing.facing
    }

    // Put back into world
    const actorWorld = (self as unknown as { world?: WorldLike }).world
    if (actorWorld !== undefined) {
      actorWorld.queueFrameEndAction(() => {
        if (self.isDead) return

        const c = this.carryall.carryable
        if (c === null) return

        const cb = ReleaseUnit._resolveCarryable(c)
        if (cb === null) return

        actorWorld.addActor(c as unknown as { actorId: number; isInWorld: boolean })
        this.carryall.detachCarryable(self)
        cb.unreserve(c)
        cb.detached(c)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  private static _resolveFacing(actor: GameActor): IFacingLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    const f = traits?.get('IFacing') ?? traits?.get('facing')
    if (f !== undefined && typeof (f as { facing?: unknown }).facing !== 'undefined') {
      return f as IFacingLike
    }
    return null
  }

  private static _resolveBodyOrientation(actor: GameActor): BodyOrientationLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    const b = traits?.get('BodyOrientation')
    if (b !== undefined && typeof (b as { quantizeOrientation?: unknown }).quantizeOrientation === 'function') {
      return b as BodyOrientationLike
    }
    return null
  }

  private static _resolveCarryable(actor: GameActor): CarryableLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<CarryableLike>
      if (typeof t.unreserve === 'function' && typeof t.detached === 'function') {
        return t as CarryableLike
      }
    }
    return null
  }

  private static _resolvePositionable(actor: GameActor): IPositionableLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<IPositionableLike>
      if (typeof t.setPosition === 'function') {
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
