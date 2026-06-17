/**
 * TDGunboat.ts — 泰伯利亚之晨炮艇（水面单位移动特质）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/TDGunboat.cs (242 lines)
 *
 * 核心范式转换:
 * - C# IPositionable + IMove + IFacing → TypeScript unified trait
 * - C# WVec.Rotate(WRot.FromYaw) → TypeScript WVec.rotate(WRot)
 * - C# IDeathActorInitModifier + IActorPreviewInitModifier → TypeScript interfaces
 * - C# WRot.Yaw / WithYaw → TypeScript rotation operations
 * - C# ActorMap.AddInfluence/RemoveInfluence → TypeScript map update stubs
 * - C# ISpeedModifier trait lookup → TypeScript speed modifier array
 *
 * NOTE: The gunboat moves in a straight line (left/right) on water terrain.
 * It turns when hitting the map boundary. Only two facings are supported (256 and 768).
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WRot } from '../../OpenRA.Game/WRot.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Left-facing angle (256 WAngle units).
 *
 * OpenRA 对照: static readonly WAngle Left = new(256)
 */
const FACING_LEFT = new WAngle(256)

/** Right-facing angle (768 WAngle units).
 *
 * OpenRA 对照: static readonly WAngle Right = new(768)
 */
const FACING_RIGHT = new WAngle(768)

// ---------------------------------------------------------------------------
// TDGunboatInfo
// OpenRA 对照: TDGunboatInfo : TraitInfo, IPositionableInfo, IFacingInfo, IMoveInfo, IActorPreviewInitInfo
// ---------------------------------------------------------------------------

/** Configuration for the TD Gunboat trait.
 *
 * OpenRA 对照: TDGunboatInfo
 */
export class TDGunboatInfo implements ITraitInfo {
  /** Movement speed per tick.
   *
   * OpenRA 对照: TDGunboatInfo.Speed
   */
  readonly speed: number

  /** Facing to use when the actor spawns. Only 256 and 768 supported.
   *
   * OpenRA 对照: TDGunboatInfo.InitialFacing
   */
  readonly initialFacing: WAngle

  /** Facing for actor previews.
   *
   * OpenRA 对照: TDGunboatInfo.PreviewFacing
   */
  readonly previewFacing: WAngle

  constructor(params?: {
    speed?: number
    initialFacing?: WAngle
    previewFacing?: WAngle
  }) {
    this.speed = params?.speed ?? 28
    this.initialFacing = params?.initialFacing ?? FACING_LEFT
    this.previewFacing = params?.previewFacing ?? FACING_LEFT
  }

  create(init: IGameActor): TDGunboat {
    return new TDGunboat(init, this)
  }
}

// ---------------------------------------------------------------------------
// TDGunboat
// OpenRA 对照: TDGunboat : ITick, ISync, IFacing, IPositionable, IMove, ...
// ---------------------------------------------------------------------------

/** Tiberian Dawn gunboat water unit movement trait.
 *
 * OpenRA 对照: TDGunboat
 *
 * Provides water-only movement for the TD Gunboat. The gunboat moves
 * continuously in its facing direction, turning only when it reaches
 * the map boundary. Only two facings (left/256 and right/768) are valid.
 */
export class TDGunboat {
  readonly info: TDGunboatInfo

  /** The owning actor.
   *
   * OpenRA 对照: TDGunboat.self (Actor)
   */
  private readonly _self: IGameActor

  // -----------------------------------------------------------------------
  // Synchronized state
  // -----------------------------------------------------------------------

  /** Current facing angle.
   *
   * OpenRA 对照: TDGunboat.Facing (VerifySync)
   */
  private _facing: WAngle

  /** World-space center position.
   *
   * OpenRA 对照: TDGunboat.CenterPosition (VerifySync)
   */
  private _centerPosition: WPos3

  // -----------------------------------------------------------------------
  // Internal state
  // -----------------------------------------------------------------------

  /** Cached cell location for boundary detection.
   *
   * OpenRA 对照: TDGunboat.cachedLocation (CPos)
   */
  private _cachedLocation: CPos2 | null = null

  /** Speed modifiers from traits.
   *
   * OpenRA 对照: TDGunboat.speedModifiers (IEnumerable<int>)
   */
  private _speedModifiers: number[] = []

  /** Whether the actor is currently in the world.
   */
  private _inWorld: boolean = false

  constructor(self: IGameActor, info: TDGunboatInfo) {
    this.info = info
    this._self = self

    // Resolve initial position
    const locationInit = (self as any).init?.get?.('LocationInit')
    const centerPosInit = (self as any).init?.get?.('CenterPositionInit')

    let pos: WPos3
    if (centerPosInit) {
      pos = { X: centerPosInit.X, Y: centerPosInit.Y, Z: centerPosInit.Z }
    } else if (locationInit) {
      pos = {
        X: (locationInit.X ?? 0) * 1024,
        Y: (locationInit.Y ?? 0) * 1024,
        Z: 0,
      }
    } else {
      pos = { X: 0, Y: 0, Z: 0 }
    }
    this._centerPosition = pos

    // Resolve initial facing
    const facingInit = (self as any).init?.get?.('FacingInit')
    let facing: WAngle
    if (facingInit) {
      facing = facingInit instanceof WAngle ? facingInit : new WAngle(facingInit.angle ?? 256)
    } else {
      facing = info.initialFacing
    }

    // Validate facing: only 256 (left) and 768 (right) are valid
    if (facing.angle !== FACING_LEFT.angle && facing.angle !== FACING_RIGHT.angle) {
      facing = facing.angle > 511 ? FACING_RIGHT : FACING_LEFT
    }
    this._facing = facing
  }

  // -----------------------------------------------------------------------
  // IFacing
  // -----------------------------------------------------------------------

  /** Current facing angle.
   *
   * OpenRA 对照: IFacing.Facing
   */
  get facing(): WAngle {
    return this._facing
  }

  set facing(value: WAngle) {
    this._facing = value
  }

  // -----------------------------------------------------------------------
  // IPositionable + IMove
  // -----------------------------------------------------------------------

  /** Current center position.
   *
   * OpenRA 对照: IPositionable.CenterPosition
   */
  get centerPosition(): WPos3 {
    return this._centerPosition
  }

  /** Top-left cell of the actor's position.
   *
   * OpenRA 对照: IPositionable.TopLeft
   */
  get topLeft(): CPos2 {
    return {
      X: Math.floor(this._centerPosition.X / 1024),
      Y: Math.floor(this._centerPosition.Y / 1024),
    }
  }

  /** Turn speed (always zero for gunboat — no gradual turn).
   *
   * OpenRA 对照: IMove.TurnSpeed
   */
  get turnSpeed(): WAngle {
    return WAngle.Zero
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Tick the gunboat movement.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   *
   * Checks if the actor left the map boundary and turns if so.
   * Then moves forward by the movement step.
   */
  tick(self: IGameActor): void {
    const currentLocation = this.topLeft

    if (this._cachedLocation) {
      if (
        currentLocation.X !== this._cachedLocation.X ||
        currentLocation.Y !== this._cachedLocation.Y
      ) {
        // Check if actor left the map
        const map = (self as any).world?.map
        if (map && !map.contains(currentLocation)) {
          this._turn()
        }
      }
    }

    this._cachedLocation = currentLocation

    // Move forward
    const step = this._moveStep(this._facing)
    this._setCenterPosition(self, {
      X: this._centerPosition.X + step.X,
      Y: this._centerPosition.Y + step.Y,
      Z: this._centerPosition.Z + step.Z,
    })
  }

  // -----------------------------------------------------------------------
  // Internal: Turn
  // -----------------------------------------------------------------------

  /** Reverse the facing direction.
   *
   * OpenRA 对照: Turn() — Facing = Facing == Left ? Right : Left
   */
  private _turn(): void {
    this._facing =
      this._facing.angle === FACING_LEFT.angle ? FACING_RIGHT : FACING_LEFT
  }

  // -----------------------------------------------------------------------
  // Internal: MoveStep
  // -----------------------------------------------------------------------

  /** Compute the movement vector for one tick.
   *
   * OpenRA 对照: MoveStep(WAngle facing)
   */
  private _moveStep(facing: WAngle): WVec {
    const speed = this._movementSpeed
    return TDGunboat.computeMoveStep(speed, facing)
  }

  /** Static: compute movement vector for a given speed and facing.
   *
   * OpenRA 对照: static WVec MoveStep(int speed, WAngle facing)
   *
   * dir = new WVec(0, -1024, 0).Rotate(WRot.FromYaw(facing))
   * return speed * dir / 1024
   */
  static computeMoveStep(speed: number, facing: WAngle): WVec {
    const dir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(facing))
    return WVec.divide(WVec.multiply(dir, speed), 1024)
  }

  /** Current movement speed after modifiers.
   *
   * OpenRA 对照: MovementSpeed property
   */
  private get _movementSpeed(): number {
    let speed = this.info.speed
    for (const mod of this._speedModifiers) {
      speed = Math.floor((speed * mod) / 100)
    }
    return speed
  }

  // -----------------------------------------------------------------------
  // Internal: SetPosition
  // -----------------------------------------------------------------------

  /** Set the center position and update maps.
   *
   * OpenRA 对照: SetPosition(Actor, WPos)
   */
  private _setCenterPosition(self: IGameActor, pos: WPos3): void {
    const world = (self as any).world
    if (world) {
      if (this._inWorld) {
        world.actorMap?.removeInfluence?.(self, this)
      }
    }

    this._centerPosition = pos

    if (world && this._inWorld) {
      world.updateMaps?.(self, this)
      world.actorMap?.addInfluence?.(self, this)
    }
  }

  // -----------------------------------------------------------------------
  // INotifyCreated
  // -----------------------------------------------------------------------

  /** Called after actor creation. Collects speed modifiers.
   *
   * OpenRA 对照: INotifyCreated.Created(Actor)
   */
  created(self: IGameActor): void {
    this._speedModifiers =
      (self as any).traitsImplementing?.('ISpeedModifier')?.map(
        (sm: any) => sm.getSpeedModifier?.(),
      ) ?? []
    this._cachedLocation = this.topLeft
  }

  // -----------------------------------------------------------------------
  // INotifyAddedToWorld / INotifyRemovedFromWorld
  // -----------------------------------------------------------------------

  /** Called when the actor is added to the world.
   *
   * OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor)
   */
  addedToWorld(self: IGameActor): void {
    this._inWorld = true
    ;(self as any).world?.addToMaps?.(self, this)
  }

  /** Called when the actor is removed from the world.
   *
   * OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor)
   */
  removedFromWorld(self: IGameActor): void {
    this._inWorld = false
    ;(self as any).world?.removeFromMaps?.(self, this)
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Whether the actor can exist in the given cell.
   */
  canExistInCell(_cell: CPos2): boolean {
    return true
  }

  /** Whether the actor can enter the given cell.
   */
  canEnterCell(_cell: CPos2): boolean {
    return true
  }

  /** Estimated duration to move between two positions.
   */
  estimatedMoveDuration(from: WPos3, to: WPos3): number {
    const dx = to.X - from.X
    const dy = to.Y - from.Y
    const dist = Math.sqrt(dx * dx + dy * dy)
    return Math.floor(dist / this.info.speed)
  }

  /** Whether the actor can enter the target immediately.
   */
  canEnterTargetNow(): boolean {
    return false
  }
}

// ---------------------------------------------------------------------------
// Local type aliases
// ---------------------------------------------------------------------------

interface WPos3 {
  X: number
  Y: number
  Z: number
}

interface CPos2 {
  X: number
  Y: number
}
