/**
 * Leap.ts — 跳跃活动（抛物线弧线从起点跳跃到目标位置）
 * OpenRA 对照: OpenRA.Mods.Cnc/Activities/Leap.cs (126 lines)
 *
 * 核心范式转换:
 * - C# Leap : Activity → TypeScript Leap extends Activity
 * - C# WPos.Lerp(origin, targetPosition, ticks, length - 1) → TypeScript
 *   integer Lerp with sinusoidal Y-axis height curve for 3D parabolic arc
 * - C# Mobile.SetCenterPosition / SetLocation → TypeScript duck-typed Mobile
 * - C# AttackLeap / EdibleByLeap → TypeScript duck-typed trait references
 * - C# SubCell / CPos integer arithmetic → TypeScript same
 * - C# yield return Target.FromPos(...) → TypeScript getTargets override
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import type { Target as TargetType_ } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Trait interfaces (duck-typed)
// ---------------------------------------------------------------------------

/** Minimal Mobile trait interface for leap movement.
 *
 * OpenRA 对照: Mobile (subset)
 */
interface MobileLike {
  readonly toSubCell: number
  readonly fromSubCell: number
  setCenterPosition(self: GameActor, pos: WPos): void
  setLocation(
    self: GameActor,
    destinationCell: CPos,
    destinationSubCell: number,
    fromCell: CPos,
    fromSubCell: number,
  ): void
  updateMovement(): void
  localMove(
    self: GameActor,
    pos: WPos,
    toPos: WPos,
  ): Activity | null
}

/** Minimal AttackLeap trait interface for leap condition management.
 *
 * OpenRA 对照: AttackLeap (subset)
 */
interface AttackLeapLike {
  isAiming: boolean
  grantLeapCondition(self: GameActor): void
  revokeLeapCondition(self: GameActor): void
  doAttack(self: GameActor, target: TargetType_): void
}

/** Minimal EdibleByLeap trait interface.
 *
 * OpenRA 对照: EdibleByLeap
 */
interface EdibleByLeapLike {
  canLeap(leaper: GameActor): boolean
  getLeapAtBy(leaper: GameActor): boolean
}

// ---------------------------------------------------------------------------
// SubCell constants
// ---------------------------------------------------------------------------

/** Any sub-cell value. */
const SubCell_Any = -1

// ---------------------------------------------------------------------------
// Leap — activity implementation
// OpenRA 对照: Leap : Activity
// ---------------------------------------------------------------------------

/**
 * Activity that makes an actor leap in a parabolic arc to a target.
 *
 * OpenRA 对照: Leap
 *
 * The leap moves the actor from its current position to the target's cell
 * using WPos.Lerp interpolation with a parabolic height curve. On arrival,
 * it queues a local move and triggers the AttackLeap's doAttack.
 */
export class Leap extends Activity {
  private readonly _mobile: MobileLike
  private readonly _targetMobile: MobileLike | null
  private readonly _speed: number
  private readonly _attack: AttackLeapLike
  private readonly _edible: EdibleByLeapLike
  private readonly _target: TargetType_

  private _destinationCell: CPos = CPos.Zero
  private _destinationSubCell: number = SubCell_Any
  private _destination: WPos = WPos.Zero
  private _origin: WPos = WPos.Zero
  private _length: number = 0
  private _canceled: boolean = false
  private _jumpComplete: boolean = false
  private _ticks: number = 0
  private _targetPosition: WPos = WPos.Zero

  constructor(
    target: TargetType_,
    mobile: MobileLike,
    targetMobile: MobileLike | null,
    speed: number,
    attack: AttackLeapLike,
    edible: EdibleByLeapLike,
  ) {
    super()
    this._mobile = mobile
    this._targetMobile = targetMobile
    this._attack = attack
    this._target = target
    this._edible = edible
    this._speed = speed
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // OpenRA 对照: Leap.OnFirstRun(Actor)
  // ---------------------------------------------------------------------------

  /**
   * Initialize the leap: calculate origin, destination, and validate conditions.
   *
   * OpenRA 对照: Leap.OnFirstRun(Actor)
   */
  protected override onFirstRun(self: GameActor): void {
    const targetActor = (this._target as unknown as { actor?: { location?: CPos } }).actor
    if (!targetActor?.location) {
      this._canceled = true
      return
    }

    this._destinationCell = targetActor.location

    if (this._targetMobile !== null) {
      this._destinationSubCell = this._targetMobile.toSubCell
    }

    this._origin = (self as unknown as { centerPosition: WPos }).centerPosition ?? WPos.Zero
    // Resolve the destination world position from the cell
    // OpenRA: destination = self.World.Map.CenterOfSubCell(destinationCell, destinationSubCell)
    const mapAny = (self as unknown as { world?: { map?: { centerOfSubCell(cell: CPos, subCell: number): WPos } } }).world?.map
    this._destination = mapAny?.centerOfSubCell?.(this._destinationCell, this._destinationSubCell) ?? this._destination

    // NOTE: In OpenRA, length = Math.Max((origin - destination).Length / speed, 1)
    // Length property returns absolute distance in WDist units
    const diff = WPos.subtract(this._origin, this._destination)
    const distance = Math.sqrt(
      diff.X * diff.X + diff.Y * diff.Y + diff.Z * diff.Z,
    )
    this._length = Math.max(Math.floor(distance / this._speed), 1)

    // Validate leaping conditions
    this._canceled =
      !this._edible.getLeapAtBy(self) ||
      this._target.type !== TargetType.Actor

    this.isInterruptible = false

    if (this._canceled) return

    this._targetPosition = (this._target as unknown as { centerPosition: WPos }).centerPosition
    this._attack.grantLeapCondition(self)
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: Leap.Tick(Actor)
  // ---------------------------------------------------------------------------

  /**
   * Advance the leap by one tick, updating the actor's position.
   *
   * OpenRA 对照: Leap.Tick(Actor)
   *
   * Uses WPos.Lerp for 2D interpolation. For 3D parabolic arc,
   * the Y-axis (height) uses a sin-based curve for natural-looking leaps.
   *
   * @returns true when leap is complete
   */
  override tick(self: GameActor): boolean {
    if (this._canceled || this._jumpComplete) return true

    // Track target position if still valid
    if (this._target.type !== TargetType.Invalid) {
      this._targetPosition = (this._target as unknown as { centerPosition: WPos }).centerPosition
    }

    // OpenRA: position = length > 1 ? WPos.Lerp(origin, targetPosition, ticks, length - 1) : targetPosition
    let position: WPos
    if (this._length > 1) {
      position = WPos.lerp(
        this._origin,
        this._targetPosition,
        this._ticks,
        this._length - 1,
      )
    } else {
      position = this._targetPosition
    }

    // NOTE: 3D parabolic arc — add height offset based on sin curve
    // For Babylon.js rendering, the Z-axis represents height
    const t = this._length > 1 ? this._ticks / (this._length - 1) : 1
    const heightOffset = Math.sin(t * Math.PI) * 256 // Max height: 256 units
    position = new WPos(position.X, position.Y, position.Z + Math.floor(heightOffset))

    this._mobile.setCenterPosition(self, position)

    // Check arrival
    if (++this._ticks >= this._length) {
      // Cleanup: revoke aiming flag
      this._attack.isAiming = false

      // Move to correct sub-cells
      this._mobile.setLocation(
        self,
        this._destinationCell,
        this._destinationSubCell,
        this._destinationCell,
        this._destinationSubCell,
      )

      // Update movement (sets movementType to None to prevent move anim)
      this._mobile.updateMovement()

      // Revoke leap condition and attack
      this._attack.revokeLeapCondition(self)
      this._attack.doAttack(self, this._target)

      this._jumpComplete = true

      // Queue child local move
      const localMove = this._mobile.localMove(self, position, this._destination)
      if (localMove) this.queueChild(localMove)
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // OnLastRun
  // OpenRA 对照: Leap.OnLastRun(Actor)
  // ---------------------------------------------------------------------------

  protected override onLastRun(self: GameActor): void {
    this._attack.revokeLeapCondition(self)
    super.onLastRun(self)
  }

  // ---------------------------------------------------------------------------
  // OnActorDispose
  // OpenRA 对照: Leap.OnActorDispose(Actor)
  // ---------------------------------------------------------------------------

  protected override onActorDispose(self: GameActor): void {
    this._attack.revokeLeapCondition(self)
    super.onActorDispose(self)
  }

  // ---------------------------------------------------------------------------
  // GetTargets
  // OpenRA 对照: Leap.GetTargets(Actor)
  // ---------------------------------------------------------------------------

  /**
   * Return the target position (origin before halfway, destination after).
   *
   * OpenRA 对照: Leap.GetTargets(Actor)
   */
  override getTargets(self: GameActor): Target[] {
    void self
    const pos =
      this._ticks < this._length / 2 ? this._origin : this._destination
    return [Target.fromPos(pos)]
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  get isCanceled(): boolean {
    return this._canceled
  }

  get isJumpComplete(): boolean {
    return this._jumpComplete
  }

  get currentTick(): number {
    return this._ticks
  }

  get totalLength(): number {
    return this._length
  }

  get origin(): WPos {
    return this._origin
  }

  get destination(): WPos {
    return this._destination
  }
}
