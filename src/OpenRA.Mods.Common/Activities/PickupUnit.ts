/**
 * PickupUnit.ts — 运输机拾取单位活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/PickupUnit.cs
 *
 * 核心范式转换:
 * - C# Carryall / Carryable traits → TypeScript 鸭子类型接口
 * - C# Fly / FlyIdle / Land / Wait / TakeOff 子活动 → TypeScript 活动队列
 * - C# self.World.AddFrameEndTask() → TypeScript world.queueFrameEndAction()
 * - C# nested AttachUnit class → TypeScript nested private class
 * - C# Target.FromActor() → TypeScript Target.fromActor()
 * - C# LockResponse enum → TypeScript LockResponse
 * - C# WVec.Rotate(WAngle) → TypeScript WVec.rotate(WRot.fromYaw(WAngle))
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  LockResponse,
  type CarryallLike,
  type CarryableLike,
  type BodyOrientationLike,
  type IFacingLike,
} from './TransportActivityInterfaces.js'

// ---------------------------------------------------------------------------
// PickupUnit
// ---------------------------------------------------------------------------

/** 拾取状态枚举。
 *
 *  OpenRA 对照: PickupState { Intercept, LockCarryable, Pickup }
 */
const PickupState = {
  Intercept: 0,
  LockCarryable: 1,
  Pickup: 2,
} as const
type PickupState = (typeof PickupState)[keyof typeof PickupState]

/**
 * 运输机拾取单位 — Carryall 拾取 Carryable actor 的活动。
 *
 * OpenRA 对照: PickupUnit activity
 *
 * 状态机:
 * 1. Intercept: 飞向目标，等待靠近
 * 2. LockCarryable: 尝试锁定目标以拾取
 * 3. Pickup: 着陆、等待、附加、起飞
 */
export class PickupUnit extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  private readonly cargo: GameActor
  private readonly carryall: CarryallLike
  private readonly carryable: CarryableLike
  private readonly carryableFacing: IFacingLike | null
  private readonly carryableBody: BodyOrientationLike | null
  private readonly delay: number
  private readonly targetLineColor: ColorStub | null

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private pickupState: PickupState = PickupState.Intercept
  private reserveFailed: boolean = false

  /** 目标锁定范围 (4 单元格)。 */
  private readonly targetLockRange = WDist.fromCells(4)

  // ---------------------------------------------------------------------------
  // Static factories for child activities (overridable for testing)
  // ---------------------------------------------------------------------------

  static _flyFactory: ((self: GameActor, target: Target) => Activity) | null = null
  static _flyIdleFactory: ((self: GameActor, idleTurn: boolean) => Activity) | null = null
  static _landFactory: ((self: GameActor, target: Target, offset: WVec, facing: WAngle) => Activity) | null = null
  static _waitFactory: ((delay: number) => Activity) | null = null
  static _takeOffFactory: ((self: GameActor) => Activity) | null = null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(self: GameActor, cargo: GameActor, delay: number, targetLineColor: ColorStub | null = null) {
    super()
    this.cargo = cargo
    this.delay = delay
    this.targetLineColor = targetLineColor

    this.carryall = PickupUnit._resolveCarryall(self)
    this.carryable = PickupUnit._resolveCarryable(cargo)
    this.carryableFacing = PickupUnit._resolveFacing(cargo)
    this.carryableBody = PickupUnit._resolveBodyOrientation(cargo)

    this.childHasPriority = false
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  protected override onFirstRun(self: GameActor): void {
    // The cargo might have become invalid while we were moving towards it
    if (this.cargo.isDead || this.carryable.isTraitDisabled ||
        this.carryall.isTraitDisabled ||
        !PickupUnit._appearsFriendlyTo(self, this.cargo)) {
      this.reserveFailed = true
      return
    }

    if (this.carryall.reserveCarryable(self, this.cargo)) {
      // Fly to the target and wait for it to be locked for pickup
      const flyFactory = PickupUnit._flyFactory
      const flyIdleFactory = PickupUnit._flyIdleFactory

      if (flyFactory !== null) {
        this.queueChild(flyFactory(self, Target.fromActor(this.cargo as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef)))
      }
      if (flyIdleFactory !== null) {
        this.queueChild(flyIdleFactory(self, false))
      }
    } else {
      this.reserveFailed = true
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    if (this.isCanceling || this.reserveFailed) {
      return true
    }

    // Check if still valid
    if (this.cargo.isDead || this.carryable.isTraitDisabled ||
        this.carryall.isTraitDisabled ||
        !PickupUnit._appearsFriendlyTo(self, this.cargo) ||
        this.cargo !== (this.carryall.carryable as unknown as GameActor)) {
      this.cancel(self, true)
      return false
    }

    // Wait until we are near the target before trying to lock it
    if (this.pickupState === PickupState.Intercept) {
      const cargoPos = (this.cargo as unknown as { centerPosition: { X: number; Y: number; Z: number } }).centerPosition
      const selfPos = (self as unknown as { centerPosition: { X: number; Y: number; Z: number } }).centerPosition
      const dx = cargoPos.X - selfPos.X
      const dy = cargoPos.Y - selfPos.Y
      const hSq = dx * dx + dy * dy

      if (hSq <= this.targetLockRange.lengthSquared) {
        this.pickupState = PickupState.LockCarryable
      }
    }

    if (this.pickupState === PickupState.LockCarryable) {
      const lockResponse = this.carryable.lockForPickup(this.cargo, self)

      if (lockResponse === LockResponse.Failed) {
        this.cancel(self, true)
        return false
      } else if (lockResponse === LockResponse.Success) {
        // Pickup position and facing are now known — swap fly/wait with Land
        if (this.childActivity !== null) {
          this.childActivity.cancel(self)
        }

        const selfActor = self as unknown as {
          orientation?: WAngle
        }
        const orientation = selfActor.orientation ?? WAngle.Zero
        const localOffset = this.carryall.offsetForCarryable(self, this.cargo)
        const quantized = this.carryableBody !== null
          ? this.carryableBody.quantizeOrientation(orientation)
          : orientation
        const rotated = localOffset.rotate(WRot.fromYaw(quantized))
        const worldOffset = this.carryableBody !== null
          ? this.carryableBody.localToWorld(rotated)
          : rotated

        const landTarget = Target.fromActor(this.cargo as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef)
        const negWorldOffset = new WVec(-worldOffset.X, -worldOffset.Y, -worldOffset.Z)
        const facing = this.carryableFacing?.facing ?? WAngle.Zero

        const landFactory = PickupUnit._landFactory
        if (landFactory !== null) {
          this.queueChild(landFactory(self, landTarget, negWorldOffset, facing))
        }

        // Pause briefly before attachment for visual effect
        if (this.delay > 0) {
          const waitFactory = PickupUnit._waitFactory
          if (waitFactory !== null) {
            this.queueChild(waitFactory(this.delay))
          }
        }

        // Remove our carryable from world
        this.queueChild(new AttachUnit(self, this.cargo, this.carryall, this.carryable))

        const takeOffFactory = PickupUnit._takeOffFactory
        if (takeOffFactory !== null) {
          this.queueChild(takeOffFactory(self))
        }

        this.pickupState = PickupState.Pickup
      }
    }

    // Return once we are in the pickup state and the pickup activities have completed
    return this.tickChild(self) && this.pickupState === PickupState.Pickup
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  override cancel(self: GameActor, keepQueue: boolean = false): void {
    super.cancel(self, keepQueue)

    // We are safe to bail here as base won't set isCanceling to true if not interruptible
    if (!this.isInterruptible) return

    // This nulls carryall storage, so to avoid deleting units make sure it's not called while carrying one
    const carryallState = this.carryall.state as number
    if (carryallState === 1) { // CarryallState.Reserved
      this.carryall.unreserveCarryable(self)
    }
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      return [new TargetLineNode(
        Target.fromActor(this.cargo as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef),
        this.targetLineColor,
      )]
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Static helpers (package-private for nested class access)
  // ---------------------------------------------------------------------------

  /** @internal Check if two actors appear friendly to each other. */
  static _appearsFriendlyTo(self: GameActor, other: GameActor): boolean {
    const selfOwner = (self as unknown as { owner?: { relationshipWith?: (o: unknown) => number } }).owner
    const otherOwner = (other as unknown as { owner?: unknown }).owner
    if (selfOwner !== undefined && otherOwner !== undefined && typeof selfOwner.relationshipWith === 'function') {
      // Ally = 4
      return selfOwner.relationshipWith(otherOwner) === 4
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution
  // ---------------------------------------------------------------------------

  private static _resolveCarryall(self: GameActor): CarryallLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<CarryallLike>
      if (typeof t.reserveCarryable === 'function' && typeof t.attachCarryable === 'function') {
        return t as CarryallLike
      }
    }
    throw new Error('PickupUnit requires a Carryall trait on the actor')
  }

  private static _resolveCarryable(cargo: GameActor): CarryableLike {
    const traits = (cargo as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<CarryableLike>
      if (typeof t.lockForPickup === 'function' && typeof t.attached === 'function') {
        return t as CarryableLike
      }
    }
    throw new Error('PickupUnit requires a Carryable trait on the cargo actor')
  }

  private static _resolveFacing(cargo: GameActor): IFacingLike | null {
    const traits = (cargo as unknown as { traits?: Map<string, unknown> }).traits
    const facing = traits?.get('IFacing') ?? traits?.get('facing')
    if (facing !== undefined && typeof (facing as { facing?: unknown }).facing !== 'undefined') {
      return facing as IFacingLike
    }
    return null
  }

  private static _resolveBodyOrientation(cargo: GameActor): BodyOrientationLike | null {
    const traits = (cargo as unknown as { traits?: Map<string, unknown> }).traits
    const body = traits?.get('BodyOrientation')
    if (body !== undefined && typeof (body as { quantizeOrientation?: unknown }).quantizeOrientation === 'function') {
      return body as BodyOrientationLike
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// AttachUnit (nested class)
// ---------------------------------------------------------------------------

/**
 * 附加单位到运输机 — 从世界中移除 cargo 并附加到 carryall。
 *
 * OpenRA 对照: PickupUnit.AttachUnit nested class
 */
class AttachUnit extends Activity {
  private readonly cargo: GameActor
  private readonly carryable: CarryableLike
  private readonly carryall: CarryallLike

  constructor(self: GameActor, cargo: GameActor, carryall: CarryallLike, carryable: CarryableLike) {
    super()
    void self // unused but kept for API consistency
    this.cargo = cargo
    this.carryall = carryall
    this.carryable = carryable
  }

  protected override onFirstRun(_self: GameActor): void {
    // The cargo might have become invalid while we were moving towards it
    if (this.cargo.isDead || this.carryable.isTraitDisabled ||
        this.carryall.isTraitDisabled ||
        this.carryall.carryable !== (this.cargo as unknown as GameActor) ||
        !PickupUnit._appearsFriendlyTo(_self, this.cargo)) {
      return
    }

    const world = (_self as unknown as { world?: WorldLike }).world
    if (world === undefined) return

    world.queueFrameEndAction(() => {
      const cargoWorld = (this.cargo as unknown as { world?: WorldLike }).world
      if (cargoWorld !== undefined) {
        cargoWorld.removeActor(this.cargo as unknown as { actorId: number })
      }
      this.carryable.attached(this.cargo, _self)
      this.carryall.attachCarryable(_self, this.cargo)
    })
  }
}

// ---------------------------------------------------------------------------
// WorldLike — 世界最小接口
// ---------------------------------------------------------------------------

interface WorldLike {
  queueFrameEndAction(action: () => void): void
  removeActor(actor: { actorId: number }): void
}
