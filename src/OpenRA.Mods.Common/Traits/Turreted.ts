/**
 * Turreted.ts -- Turret rotation and facing trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Turreted.cs (333 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<TurretedInfo>, ITick, IDeathActorInitModifier,
 *   IActorPreviewInitModifier, ISync → TS ConditionalTrait<TurretedInfo>
 * - C# WRot.LocalOrientation.Yaw → TS WRot yaw property
 * - C# Util.TickFacing() → TS WAngle.tickFacing()
 * - C# BodyOrientation → TS duck-typed
 * - C# IFacing → TS IFacing interface
 * - 3D: TransformNode.rotation.y = worldOrientation.yaw.angle * (2*PI/1024)
 * - IDeathActorInitModifier deferred (TODO-8.E.TURRET-HUSK)
 * - IActorPreviewInitModifier deferred (TODO-8.E.TURRET-PREVIEW)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
  type ISync,
  type IFacing,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WRot } from '../../OpenRA.Game/WRot.js'

// ---------------------------------------------------------------------------
// TurretedInfo
// OpenRA 对照: TurretedInfo (PausableConditionalTraitInfo, Requires<BodyOrientationInfo>)
// ---------------------------------------------------------------------------

/** Configuration for Turreted trait.
 *
 *  OpenRA 对照: TurretedInfo
 */
export class TurretedInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Turret name for multi-turret disambiguation.
   *
   *  OpenRA 对照: TurretedInfo.Turret (default "primary")
   */
  readonly turret: string = 'primary'

  /** Speed at which the turret turns (angle units per tick).
   *
   *  OpenRA 对照: TurretedInfo.TurnSpeed (default new WAngle(512))
   */
  readonly turnSpeed: WAngle = new WAngle(512)

  /** Initial facing angle.
   *
   *  OpenRA 对照: TurretedInfo.InitialFacing (default WAngle.Zero)
   */
  readonly initialFacing: WAngle = WAngle.Zero

  /** Number of ticks before turret is realigned. (-1 turns off realignment)
   *
   *  OpenRA 对照: TurretedInfo.RealignDelay (default 40)
   */
  readonly realignDelay: number = 40

  /** Muzzle position relative to turret or body. (forward, right, up) triples.
   *
   *  OpenRA 对照: TurretedInfo.Offset (default WVec.Zero)
   */
  readonly offset: WVec = WVec.Zero

  /** Display order for the turret facing slider in the map editor.
   *
   *  OpenRA 对照: TurretedInfo.EditorTurretFacingDisplayOrder (default 4)
   */
  readonly editorTurretFacingDisplayOrder: number = 4

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    turret?: string
    turnSpeed?: WAngle
    initialFacing?: WAngle
    realignDelay?: number
    offset?: WVec
    editorTurretFacingDisplayOrder?: number
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.turret = params.turret ?? 'primary'
    this.turnSpeed = params.turnSpeed ?? new WAngle(512)
    this.initialFacing = params.initialFacing ?? WAngle.Zero
    this.realignDelay = params.realignDelay ?? 40
    this.offset = params.offset ?? WVec.Zero
    this.editorTurretFacingDisplayOrder = params.editorTurretFacingDisplayOrder ?? 4
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// TurretFacingInit — initializer for turret facing
// OpenRA 对照: TurretFacingInit : ValueActorInit<WAngle>
// ---------------------------------------------------------------------------

/** Initializer for turret facing.
 *
 *  OpenRA 对照: TurretFacingInit
 */
export class TurretFacingInit {
  readonly value: WAngle

  /** Trait info this init belongs to (for instance discrimination).
   *
   *  OpenRA 对照: ValueActorInit<T>.Info
   */
  readonly traitInfo: TurretedInfo

  constructor(traitInfo: TurretedInfo, value: WAngle) {
    this.traitInfo = traitInfo
    this.value = value
  }
}

// ---------------------------------------------------------------------------
// DynamicTurretFacingInit — dynamic facing initializer
// OpenRA 对照: DynamicTurretFacingInit : ValueActorInit<Func<WAngle>>
// ---------------------------------------------------------------------------

/** Dynamic initializer for turret facing (evaluated at creation time).
 *
 *  OpenRA 对照: DynamicTurretFacingInit
 */
export class DynamicTurretFacingInit {
  readonly value: () => WAngle
  readonly traitInfo: TurretedInfo

  constructor(traitInfo: TurretedInfo, value: () => WAngle) {
    this.traitInfo = traitInfo
    this.value = value
  }
}

// ---------------------------------------------------------------------------
// Turreted
// OpenRA 对照: Turreted (PausableConditionalTrait<TurretedInfo>, ITick, ISync)
// ---------------------------------------------------------------------------

/** Manages turret rotation, facing toward targets, and realignment.
 *
 *  OpenRA 对照: Turreted
 *
 *  Supports multiple turrets per actor via instance name.
 *  Each Turreted instance manages its own rotation state.
 *
 *  In 3D (TODO-8.E.BILLBOARD-3D): a child TransformNode handles
 *  turret rotation: turretNode.rotation.y = worldOrientation.yaw.angle * (2*PI/1024)
 */
export class Turreted
  extends ConditionalTrait<TurretedInfo>
  implements ITick, ISync
{
  // -----------------------------------------------------------------------
  // Attack integration
  // -----------------------------------------------------------------------

  /** The matching AttackTurreted trait (if any).
   *
   *  OpenRA 对照: Turreted.attack
   */
  attack: unknown | null = null

  // -----------------------------------------------------------------------
  // Facing / Orientation
  // -----------------------------------------------------------------------

  /** The actor's IFacing trait (may be null for buildings).
   *
   *  OpenRA 对照: Turreted.facing
   */
  facing: IFacing | null = null

  /** The actor's BodyOrientation trait.
   *
   *  OpenRA 对照: Turreted.body
   */
  body: unknown | null = null

  /** Quantized facings for sprite rendering (0 = no quantization).
   *
   *  OpenRA 对照: Turreted.QuantizedFacings [VerifySync]
   */
  quantizedFacings: number = 0

  // -----------------------------------------------------------------------
  // Rotation state
  // -----------------------------------------------------------------------

  /** Desired direction vector (target direction in world space).
   *
   *  OpenRA 对照: Turreted.desiredDirection
   */
  desiredDirection: WVec = WVec.Zero

  /** Tick counter for realignment delay.
   *
   *  OpenRA 对照: Turreted.realignTick
   */
  realignTick: number = 0

  /** Whether the turret should realign to initial facing.
   *
   *  OpenRA 对照: Turreted.realignDesired
   */
  realignDesired: boolean = false

  /** Local orientation (turret rotation relative to body).
   *
   *  OpenRA 对照: Turreted.LocalOrientation
   */
  localOrientation: WRot

  /** Local offset (for subclasses that want to move the turret relative to the body).
   *
   *  OpenRA 对照: Turreted.localOffset (protected, default WVec.Zero)
   */
  protected localOffset: WVec = WVec.Zero

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  /** Turret name.
   *
   *  OpenRA 对照: Turreted.Name
   */
  get name(): string {
    return this.info.turret
  }

  /** Turret offset in world-space (body-relative offset).
   *
   *  OpenRA 对照: Turreted.Offset
   */
  get totalOffset(): WVec {
    // OpenRA: return Info.Offset + localOffset
    return WVec.add(this.info.offset, this.localOffset)
  }

  /** World-space orientation (accounting for body facing).
   *
   *  OpenRA 对照: Turreted.WorldOrientation
   */
  get worldOrientation(): WRot {
    const world = this.facing
      ? this.localOrientation.rotate(this.facing.orientation)
      : this.localOrientation
    if (this.quantizedFacings === 0) return world
    // Quantize orientation to match a rendered sprite
    // Implies no pitch or roll
    const bodyOri = this.body as {
      quantizeFacing?: (facing: WAngle) => WAngle
    } | null
    return WRot.fromYaw(
      bodyOri?.quantizeFacing?.(world.yaw) ?? world.yaw,
    )
  }

  /** The desired local facing (relative to body).
   *
   *  OpenRA 对照: Turreted.DesiredLocalFacing
   */
  private get desiredLocalFacing(): WAngle {
    // A zero value means that we have a target, but it is on top of us
    if (WVec.equals(this.desiredDirection, WVec.Zero)) {
      return this.localOrientation.yaw
    }

    if (this.facing === null) {
      return this.desiredDirection.yaw
    }

    // PERF: If the turret rotation axis is vertical we can directly take
    // the difference in facing/yaw
    const orientation = this.facing.orientation
    if (
      WAngle.equals(orientation.pitch, WAngle.Zero) &&
      WAngle.equals(orientation.roll, WAngle.Zero)
    ) {
      return WAngle.subtract(this.desiredDirection.yaw, orientation.yaw)
    }

    // If the turret rotation axis is not vertical we must transform the
    // target direction into the turret's local coordinate system
    return this.desiredDirection.rotate(WRot.negate(orientation)).yaw
  }

  /** Whether the turret has achieved its desired facing.
   *
   *  OpenRA 对照: Turreted.HasAchievedDesiredFacing
   */
  get hasAchievedDesiredFacing(): boolean {
    const desired = this.realignDesired
      ? this.info.initialFacing
      : this.desiredLocalFacing
    return WAngle.equals(desired, this.localOrientation.yaw)
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  constructor(info: TurretedInfo) {
    super(info)
    this.localOrientation = WRot.fromYaw(info.initialFacing)
  }

  /** Initialize after actor creation.
   *
   *  OpenRA 对照: Turreted.Created(Actor self)
   *
   *  @param self — the actor
   *  @param attack — the matching AttackTurreted (or null)
   *  @param facing — the IFacing trait (or null)
   *  @param body — the BodyOrientation trait
   */
  created(
    _self: IGameActor,
    attack: unknown | null,
    facing: IFacing | null,
    body: unknown,
  ): void {
    this.attack = attack
    this.facing = facing
    this.body = body
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Tick: update turret rotation toward desired facing.
   *
   *  OpenRA 对照: ITick.Tick(Actor self) → Tick(Actor self)
   */
  tick(_self: IGameActor): void {
    if (this.isTraitDisabled) return

    // NOTE: FaceTarget is called in AttackTurreted.CanAttack if the turret has a target.
    if (this.attack !== null) {
      const atk = this.attack as {
        isAiming?: boolean
        isTraitDisabled?: boolean
        isTraitPaused?: boolean
      }

      // Only realign while not attacking anything
      if (atk.isAiming) {
        this.realignTick = 0
        return
      }

      if (this.realignTick < this.info.realignDelay) {
        this.realignTick++
      } else if (this.info.realignDelay > -1) {
        this.realignDesired = true
        this.desiredDirection = WVec.Zero
      }

      this.moveTurret()
    } else {
      this.realignTick = 0
      this.moveTurret()
    }
  }

  /** Face a target from this turret.
   *
   *  OpenRA 对照: Turreted.FaceTarget(Actor self, in Target target)
   *
   *  @param self — the actor
   *  @param target — the target to face
   *  @returns whether the turret has achieved the desired facing
   */
  faceTarget(self: IGameActor, target: unknown): boolean {
    if (
      this.isTraitDisabled ||
      this.isTraitPaused ||
      this.attack === null
    ) {
      return false
    }

    const atk = this.attack as {
      isTraitDisabled?: boolean
      isTraitPaused?: boolean
      getTargetPosition?: (turretPos: unknown, tgt: unknown) => WPosStub
    }

    if (atk.isTraitDisabled || atk.isTraitPaused) return false

    const targetType = (target as { type?: number }).type
    if (targetType === undefined || targetType === TargetTypeStub.Invalid) {
      this.desiredDirection = WVec.Zero
      return false
    }

    const turretPos = (self as unknown as { centerPosition?: WPosStub }).centerPosition
    if (!turretPos) return false

    const turretWorldPos = this.position(self)
    const totalPos = {
      X: turretPos.X + turretWorldPos.X,
      Y: turretPos.Y + turretWorldPos.Y,
      Z: turretPos.Z + turretWorldPos.Z,
    }

    const targetPos = atk.getTargetPosition?.(totalPos, target) ?? {
      X: (target as { centerPosition?: WPosStub }).centerPosition?.X ?? 0,
      Y: (target as { centerPosition?: WPosStub }).centerPosition?.Y ?? 0,
      Z: (target as { centerPosition?: WPosStub }).centerPosition?.Z ?? 0,
    }

    this.desiredDirection = new WVec(
      targetPos.X - totalPos.X,
      targetPos.Y - totalPos.Y,
      targetPos.Z - totalPos.Z,
    )
    this.realignDesired = false

    this.moveTurret()
    return this.hasAchievedDesiredFacing
  }

  // -----------------------------------------------------------------------
  // Position
  // -----------------------------------------------------------------------

  /** Turret offset in world-space.
   *
   *  OpenRA 对照: Turreted.Position(Actor self)
   *
   *  @param self — the actor
   *  @returns world-space offset of the turret from the actor center
   */
  position(self: IGameActor): WVec {
    const bodyOri = this.body as {
      quantizeOrientation?: (orientation: WRot) => WRot
      localToWorld?: (offset: WVec) => WVec
    } | null

    if (!bodyOri) return this.totalOffset

    const orientation = (self as unknown as { orientation?: WRot }).orientation ?? WRot.None
    const bodyOrientation = bodyOri.quantizeOrientation?.(orientation) ?? orientation
    return bodyOri.localToWorld?.(this.totalOffset.rotate(bodyOrientation)) ?? this.totalOffset
  }

  // -----------------------------------------------------------------------
  // Private: moveTurret
  // OpenRA 对照: Turreted.MoveTurret()
  // -----------------------------------------------------------------------

  /** Advance turret rotation toward desired facing by at most turnSpeed.
   *
   *  OpenRA 对照: Turreted.MoveTurret()
   */
  private moveTurret(): void {
    const desired = this.realignDesired
      ? this.info.initialFacing
      : this.desiredLocalFacing
    if (WAngle.equals(desired, this.localOrientation.yaw)) return

    this.localOrientation = this.localOrientation.withYaw(
      WAngle.tickFacing(this.localOrientation.yaw, desired, this.info.turnSpeed),
    )

    if (WAngle.equals(desired, this.localOrientation.yaw)) {
      this.realignDesired = false
      this.desiredDirection = WVec.Zero
    }
  }

  // -----------------------------------------------------------------------
  // TraitDisabled
  // -----------------------------------------------------------------------

  /** Stop attack when trait is disabled.
   *
   *  OpenRA 对照: Turreted.TraitDisabled(Actor self)
   */
  protected override traitDisabled(self: IGameActor): void {
    const atk = this.attack as {
      isAiming?: boolean
      onStopOrder?: (self: IGameActor) => void
    } | null
    if (atk?.isAiming) {
      atk.onStopOrder?.(self)
    }
  }

  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  /** Compute world facing from an initializer.
   *
   *  OpenRA 对照: TurretedInfo.WorldFacingFromInit(IActorInitializer, TraitInfo, WAngle)
   *
   *  (Dynamic)TurretFacingInit is specified relative to the actor body.
   *  We need to add the body facing to return an absolute world angle.
   */
  static worldFacingFromInit(
    init: Record<string, unknown>,
    info: TurretedInfo,
    defaultFacing: WAngle,
  ): () => WAngle {
    const bodyFacingInit = init.facingInit as { value?: WAngle } | undefined
    const bodyFacing = bodyFacingInit?.value
      ? (() => bodyFacingInit.value!) as () => WAngle
      : null

    const turretFacingInit = init.turretFacing as TurretFacingInit | undefined
    if (turretFacingInit && turretFacingInit.traitInfo === info) {
      const facing = turretFacingInit.value
      return bodyFacing ? () => WAngle.add(bodyFacing(), facing) : () => facing
    }

    const dynamicFacingInit = init.dynamicTurretFacing as DynamicTurretFacingInit | undefined
    if (dynamicFacingInit && dynamicFacingInit.traitInfo === info) {
      return bodyFacing
        ? () => WAngle.add(bodyFacing(), dynamicFacingInit.value())
        : dynamicFacingInit.value
    }

    return bodyFacing ?? (() => defaultFacing)
  }

  /** Compute local facing from an initializer.
   *
   *  OpenRA 对照: TurretedInfo.LocalFacingFromInit(IActorInitializer)
   */
  static localFacingFromInit(
    init: Record<string, unknown>,
    info: TurretedInfo,
  ): () => WAngle {
    const turretFacingInit = init.turretFacing as TurretFacingInit | undefined
    if (turretFacingInit && turretFacingInit.traitInfo === info) {
      const facing = turretFacingInit.value
      return () => facing
    }

    const dynamicFacingInit = init.dynamicTurretFacing as DynamicTurretFacingInit | undefined
    if (dynamicFacingInit && dynamicFacingInit.traitInfo === info) {
      return dynamicFacingInit.value
    }

    return () => info.initialFacing
  }
}

// ---------------------------------------------------------------------------
// TargetType stub (for faceTarget type check)
// ---------------------------------------------------------------------------

const TargetTypeStub = {
  Invalid: 0,
} as const

// ---------------------------------------------------------------------------
// WPosStub — minimal position interface
// ---------------------------------------------------------------------------

interface WPosStub {
  X: number
  Y: number
  Z: number
}
